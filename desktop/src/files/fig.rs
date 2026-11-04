use serde::Deserialize;
use std::io::{Cursor, Write};
use tauri::ipc::{InvokeBody, Request};

#[derive(Deserialize)]
struct ImageEntry {
    name: String,
    size: usize,
}

/// The zstd level Figma itself saves with.
const DEFAULT_COMPRESSION_LEVEL: i32 = 3;

/// The small fields of the archive a save writes, including whether it is a FigJam board, which
/// `.jam` marks only in the canvas header, and the byte length of each part that follows.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FigFileManifest {
    meta_json: String,
    fig_kiwi_version: Option<u32>,
    compression_level: Option<i32>,
    #[serde(default)]
    board: bool,
    schema_deflated: usize,
    kiwi_data: usize,
    thumbnail_png: usize,
    #[serde(default)]
    images: Vec<ImageEntry>,
}

/// The archive a save writes, its parts borrowed from the request body; `images` holds the data
/// of `manifest.images`, in order.
struct FigFile<'a> {
    manifest: FigFileManifest,
    schema_deflated: &'a [u8],
    kiwi_data: &'a [u8],
    thumbnail_png: &'a [u8],
    images: Vec<&'a [u8]>,
}

/// Splits `count` bytes off the front of `rest`.
fn take<'a>(rest: &mut &'a [u8], count: usize, what: &str) -> Result<&'a [u8], String> {
    if rest.len() < count {
        return Err(format!("the .fig request ends inside {what}"));
    }
    let (head, tail) = rest.split_at(count);
    *rest = tail;
    Ok(head)
}

/// Reads the body `src/app/document/io/native-fig.ts` sends: a little-endian u32 manifest length,
/// the manifest as JSON, then the schema, Kiwi data, thumbnail and images back to back. The parts
/// travel raw, since as JSON they would take one number per byte.
fn read_fig_file(body: &[u8]) -> Result<FigFile<'_>, String> {
    let mut rest = body;
    let length = take(&mut rest, 4, "the manifest length")?;
    let length = u32::from_le_bytes([length[0], length[1], length[2], length[3]]) as usize;
    let manifest: FigFileManifest =
        serde_json::from_slice(take(&mut rest, length, "the manifest")?)
            .map_err(|e| e.to_string())?;
    let schema_deflated = take(&mut rest, manifest.schema_deflated, "the schema")?;
    let kiwi_data = take(&mut rest, manifest.kiwi_data, "the Kiwi data")?;
    let thumbnail_png = take(&mut rest, manifest.thumbnail_png, "the thumbnail")?;
    let images = manifest
        .images
        .iter()
        .map(|entry| take(&mut rest, entry.size, "an image"))
        .collect::<Result<Vec<_>, _>>()?;
    if !rest.is_empty() {
        return Err("the .fig request has bytes past its last image".into());
    }
    Ok(FigFile {
        manifest,
        schema_deflated,
        kiwi_data,
        thumbnail_png,
        images,
    })
}

/// The request's bytes: raw over Tauri's `ipc://` protocol, or a JSON array of numbers once a
/// webview that blocks that protocol has made Tauri fall back to `postMessage`. They are copied
/// because the request is borrowed and the blocking thread needs them for as long as it runs.
fn request_bytes(body: &InvokeBody) -> Result<Vec<u8>, String> {
    match body {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(value) => Vec::<u8>::deserialize(value)
            .map_err(|_| "build_fig_file expects the request body as bytes".to_string()),
    }
}

/// Writes the `.fig` or `.jam` archive on a blocking thread: high zstd levels take seconds on
/// large documents, which would otherwise stall the window.
#[tauri::command]
pub async fn build_fig_file(request: Request<'_>) -> Result<tauri::ipc::Response, String> {
    let body = request_bytes(request.body())?;
    tauri::async_runtime::spawn_blocking(move || write_fig_file(read_fig_file(&body)?))
        .await
        .map_err(|e| e.to_string())?
}

fn write_fig_file(file: FigFile<'_>) -> Result<tauri::ipc::Response, String> {
    let FigFile {
        manifest,
        schema_deflated,
        kiwi_data,
        thumbnail_png,
        images,
    } = file;
    let levels = zstd::compression_level_range();
    let level = manifest
        .compression_level
        .unwrap_or(DEFAULT_COMPRESSION_LEVEL)
        .clamp(*levels.start(), *levels.end());
    // Figma rejects zstd frames that do not declare their decompressed size.
    let mut encoder = zstd::Encoder::new(Vec::new(), level).map_err(|e| e.to_string())?;
    encoder
        .include_contentsize(true)
        .map_err(|e| e.to_string())?;
    encoder
        .set_pledged_src_size(Some(kiwi_data.len() as u64))
        .map_err(|e| e.to_string())?;
    encoder.write_all(kiwi_data).map_err(|e| e.to_string())?;
    let zstd_data = encoder.finish().map_err(|e| e.to_string())?;

    let version: u32 = manifest.fig_kiwi_version.unwrap_or(101);
    let fig_kiwi_len = 8 + 4 + 4 + schema_deflated.len() + 4 + zstd_data.len();
    let mut fig_kiwi = Vec::with_capacity(fig_kiwi_len);
    // A FigJam board's `.jam` differs from a design's `.fig` only in this header.
    fig_kiwi.extend_from_slice(if manifest.board {
        b"fig-jam."
    } else {
        b"fig-kiwi"
    });
    fig_kiwi.extend_from_slice(&version.to_le_bytes());
    fig_kiwi.extend_from_slice(&(schema_deflated.len() as u32).to_le_bytes());
    fig_kiwi.extend_from_slice(schema_deflated);
    fig_kiwi.extend_from_slice(&(zstd_data.len() as u32).to_le_bytes());
    fig_kiwi.extend_from_slice(&zstd_data);

    let buf = Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(buf);
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

    zip.start_file("canvas.fig", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(&fig_kiwi).map_err(|e| e.to_string())?;

    zip.start_file("thumbnail.png", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(thumbnail_png).map_err(|e| e.to_string())?;

    zip.start_file("meta.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(manifest.meta_json.as_bytes())
        .map_err(|e| e.to_string())?;

    for (entry, data) in manifest.images.iter().zip(images) {
        zip.start_file(entry.name.as_str(), options)
            .map_err(|e| e.to_string())?;
        zip.write_all(data).map_err(|e| e.to_string())?;
    }

    let result = zip.finish().map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(result.into_inner()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::ipc::IpcResponse;

    /// A body laid out as `native-fig.ts` writes it.
    fn request_body(manifest: &str, parts: &[&[u8]]) -> Vec<u8> {
        let mut body = (manifest.len() as u32).to_le_bytes().to_vec();
        body.extend_from_slice(manifest.as_bytes());
        for part in parts {
            body.extend_from_slice(part);
        }
        body
    }

    const MANIFEST: &str = r#"{"metaJson":"{\"file_name\":\"Café\"}","figKiwiVersion":106,"board":true,"schemaDeflated":2,"kiwiData":3,"thumbnailPng":1,"images":[{"name":"images/a","size":2},{"name":"images/b","size":0}]}"#;

    #[test]
    fn reads_each_part_from_the_body() {
        let body = request_body(MANIFEST, &[b"sc", b"kiw", b"t", b"im"]);
        let file = read_fig_file(&body).unwrap();
        assert_eq!(file.schema_deflated, b"sc");
        assert_eq!(file.kiwi_data, b"kiw");
        assert_eq!(file.thumbnail_png, b"t");
        assert_eq!(file.images, vec![&b"im"[..], &b""[..]]);
        assert_eq!(file.manifest.images[1].name, "images/b");
        assert_eq!(file.manifest.meta_json, r#"{"file_name":"Café"}"#);
        assert_eq!(file.manifest.fig_kiwi_version, Some(106));
        assert_eq!(file.manifest.compression_level, None);
        assert!(file.manifest.board);
    }

    #[test]
    fn rejects_a_body_whose_parts_do_not_match_the_manifest() {
        assert!(read_fig_file(&request_body(MANIFEST, &[b"sc", b"kiw", b"t", b"i"])).is_err());
        assert!(read_fig_file(&request_body(MANIFEST, &[b"sc", b"kiw", b"t", b"im!"])).is_err());
        assert!(read_fig_file(&[1, 0]).is_err());
    }

    #[test]
    fn reads_the_bytes_of_a_postmessage_fallback_body() {
        let body = request_body(MANIFEST, &[b"sc", b"kiw", b"t", b"im"]);
        let json = InvokeBody::Json(serde_json::json!(body));
        assert_eq!(request_bytes(&json).unwrap(), body);
        assert_eq!(request_bytes(&InvokeBody::Raw(body.clone())).unwrap(), body);
        assert!(request_bytes(&InvokeBody::Json(serde_json::json!([1, 256]))).is_err());
        assert!(request_bytes(&InvokeBody::Json(serde_json::json!({ "kiwiData": [1] }))).is_err());
    }

    #[test]
    fn packs_the_parts_into_a_stored_zip() {
        let body = request_body(MANIFEST, &[b"sc", b"kiw", b"t", b"im"]);
        let bytes = write_fig_file(read_fig_file(&body).unwrap())
            .unwrap()
            .body()
            .unwrap();
        let tauri::ipc::InvokeResponseBody::Raw(bytes) = bytes else {
            panic!("expected raw bytes");
        };
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let names: Vec<_> = zip.file_names().map(str::to_owned).collect();
        for name in [
            "canvas.fig",
            "thumbnail.png",
            "meta.json",
            "images/a",
            "images/b",
        ] {
            assert!(names.iter().any(|n| n == name), "{name} missing: {names:?}");
        }
        let mut canvas = Vec::new();
        std::io::Read::read_to_end(&mut zip.by_name("canvas.fig").unwrap(), &mut canvas).unwrap();
        assert_eq!(&canvas[..8], b"fig-jam.");
        assert_eq!(&canvas[8..12], &106u32.to_le_bytes());
    }
}

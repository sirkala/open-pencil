//! Documents and links a launch names in its arguments.

use std::path::{Path, PathBuf};

pub fn file_association_path(path: PathBuf) -> Option<PathBuf> {
    let path = path.canonicalize().ok()?;
    if !path.is_file() {
        return None;
    }
    let ext = path.extension()?.to_string_lossy().to_lowercase();
    matches!(
        ext.as_str(),
        "fig" | "jam" | "pen" | "drawio" | "dio" | "mmd" | "mermaid"
    )
    .then_some(path)
}

fn path_from_arg(arg: String, cwd: &Path) -> Option<PathBuf> {
    if arg.starts_with('-') {
        return None;
    }

    if let Ok(url) = tauri::Url::parse(&arg) {
        if let Ok(path) = url.to_file_path() {
            return Some(path);
        }
    }

    let path = PathBuf::from(arg);
    Some(if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    })
}

pub fn open_paths_from_args(args: Vec<String>, cwd: &Path) -> Vec<PathBuf> {
    args.into_iter()
        .filter_map(|arg| path_from_arg(arg, cwd))
        .filter_map(file_association_path)
        .collect()
}

/// `openpencil://` URLs among a second launch's arguments: Windows and Linux start a new
/// process for a link, and the single-instance plugin hands its arguments to this one.
#[cfg(all(
    any(target_os = "macos", windows, target_os = "linux"),
    not(feature = "native-test")
))]
pub fn deep_links_from_args(args: &[String]) -> Vec<url::Url> {
    args.iter()
        .filter(|arg| {
            arg.strip_prefix(super::links::SCHEME)
                .is_some_and(|rest| rest.starts_with("://"))
        })
        .filter_map(|arg| url::Url::parse(arg).ok())
        .collect()
}

pub fn startup_open_paths() -> Vec<PathBuf> {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    open_paths_from_args(std::env::args().skip(1).collect(), &cwd)
}

#[cfg(all(test, not(feature = "native-test")))]
mod tests {
    use super::super::links::SCHEME;
    use super::deep_links_from_args;

    #[test]
    fn deep_links_keep_only_this_builds_scheme() {
        let args = [
            format!("{SCHEME}://open?file=a.pen"),
            format!("{SCHEME}x://open?file=a.pen"),
            "other://open?file=a.pen".to_string(),
            "a.pen".to_string(),
        ];
        let links = deep_links_from_args(&args);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].scheme(), SCHEME);
    }
}

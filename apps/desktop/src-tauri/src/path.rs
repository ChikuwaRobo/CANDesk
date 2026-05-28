use std::path::PathBuf;

use serde::de::DeserializeOwned;

pub(crate) fn read_json_file<T>(path: &str) -> Result<T, String>
where
    T: DeserializeOwned,
{
    let resolved = resolve_existing_path(path)?;
    let file = std::fs::File::open(&resolved)
        .map_err(|error| format!("failed to open {}: {error}", resolved.display()))?;
    serde_json::from_reader(file)
        .map_err(|error| format!("failed to parse {}: {error}", resolved.display()))
}

pub(crate) fn resolve_existing_path(path: &str) -> Result<PathBuf, String> {
    let input = PathBuf::from(path);
    if input.is_absolute() && input.exists() {
        return Ok(input);
    }
    if input.exists() {
        return Ok(input);
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidates = [
        manifest_dir.join(&input),
        manifest_dir.join("..").join(&input),
        manifest_dir.join("..").join("..").join(&input),
        manifest_dir.join("..").join("..").join("..").join(&input),
    ];
    candidates
        .into_iter()
        .find(|candidate| candidate.exists())
        .ok_or_else(|| format!("file not found: {path}"))
}

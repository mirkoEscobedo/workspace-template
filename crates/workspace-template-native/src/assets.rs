use sha2::{Digest, Sha256};
use std::path::Path;

pub struct Asset {
    pub path: &'static str,
    pub bytes: &'static [u8],
}

include!(concat!(env!("OUT_DIR"), "/embedded_assets.rs"));

pub fn paths() -> Vec<&'static str> {
    EMBEDDED_ASSETS.iter().map(|asset| asset.path).collect()
}

pub fn manifest_sha256() -> String {
    let mut manifest = Sha256::new();
    for asset in EMBEDDED_ASSETS {
        manifest.update(asset.path.as_bytes());
        manifest.update([0]);
        manifest.update(Sha256::digest(asset.bytes));
    }
    hex::encode(manifest.finalize())
}

pub fn verify_readable(root: &Path) -> (usize, Vec<String>) {
    let mut verified = 0;
    let mut mismatches = Vec::new();
    for asset in EMBEDDED_ASSETS {
        match std::fs::read(root.join(asset.path)) {
            Ok(bytes) if Sha256::digest(&bytes) == Sha256::digest(asset.bytes) => {
                verified += 1;
            }
            Ok(_) => mismatches.push(format!("{}: hash mismatch", asset.path)),
            Err(error) => mismatches.push(format!("{}: {error}", asset.path)),
        }
    }
    (verified, mismatches)
}

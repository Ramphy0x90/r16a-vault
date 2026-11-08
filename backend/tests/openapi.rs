//! Keeps `docs/openapi.json` in sync with the handlers. Run with `R16A_WRITE_OPENAPI=1` to refresh.

use r16a_vault_backend::openapi::document;

#[test]
fn openapi_document_is_current() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../docs/openapi.json");
    let doc = document().to_pretty_json().expect("serialisable") + "\n";
    if std::env::var_os("R16A_WRITE_OPENAPI").is_some() {
        std::fs::write(path, &doc).expect("write openapi.json");
    }
    let on_disk = std::fs::read_to_string(path).unwrap_or_default();
    assert_eq!(
        on_disk, doc,
        "docs/openapi.json is stale, rerun with R16A_WRITE_OPENAPI=1"
    );
}

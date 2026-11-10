//! Username canonicalisation shared by registration, prelogin and login.

use unicode_normalization::UnicodeNormalization;

use crate::error::AppError;

pub const MIN_LEN: usize = 3;
/// Long enough for any email address, whose SMTP path limit is 254 characters.
pub const MAX_LEN: usize = 254;

/// Trims, applies NFC and lowercases so visually identical names map to one account.
/// Letters, digits, dot, underscore, hyphen, plus and at survive validation, so an email
/// address works as a username while whitespace and control tricks inside the name do not.
/// The name is never treated as a mailbox, so its shape as an address is not checked.
pub fn normalize(raw: &str) -> Result<String, AppError> {
    if raw.len() > MAX_LEN * 8 {
        return Err(AppError::BadRequest("invalid-username"));
    }
    let n: String = raw.trim().nfc().collect::<String>().to_lowercase();
    let count = n.chars().count();
    let allowed = n
        .chars()
        .all(|c| c.is_alphanumeric() || matches!(c, '.' | '_' | '-' | '+' | '@'));
    if !(MIN_LEN..=MAX_LEN).contains(&count) || !allowed {
        return Err(AppError::BadRequest("invalid-username"));
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_and_lowercases() {
        assert_eq!(normalize("  Alice ").unwrap(), "alice");
    }

    #[test]
    fn nfc_composes() {
        let decomposed = "Jose\u{0301}";
        let composed = "jos\u{00e9}";
        assert_eq!(normalize(decomposed).unwrap(), composed);
    }

    #[test]
    fn accepts_email_addresses() {
        assert_eq!(
            normalize(" Alice.Smith+vault@Example.COM ").unwrap(),
            "alice.smith+vault@example.com"
        );
        assert!(normalize(&format!("{}@example.com", "a".repeat(242))).is_ok());
    }

    #[test]
    fn rejects_bad_names() {
        for bad in [
            "ab",
            "a b c",
            "x\u{0000}yz",
            "semi;colon",
            "a<b>@c.d",
            "\"quoted\"@x.y",
            &"a".repeat(255),
        ] {
            assert!(normalize(bad).is_err(), "{bad:?}");
        }
    }
}

//! Core library for CANRush.
//!
//! This crate will hold the shared CAN data model, protocol parsers,
//! frame hub, capture service, and transmit scheduler used by both the
//! desktop app and CLI.

/// Returns the crate name used by smoke tests and early workspace checks.
pub fn crate_name() -> &'static str {
    "canrush-core"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crate_name_is_stable() {
        assert_eq!(crate_name(), "canrush-core");
    }
}

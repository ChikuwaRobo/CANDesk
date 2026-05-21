//! Core library for CANRush.

#![cfg_attr(test, allow(clippy::unwrap_used))]

pub mod adapter;
pub mod capture;
pub mod error;
pub mod model;
pub mod protocol;
pub mod server;

pub use error::{CanrushError, Result};

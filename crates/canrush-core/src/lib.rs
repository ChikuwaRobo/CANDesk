//! Core library for CANRush.

#![cfg_attr(test, allow(clippy::unwrap_used))]

pub mod adapter;
pub mod api;
pub mod capture;
pub mod endpoint;
pub mod error;
pub mod model;
pub mod protocol;
pub mod server;

pub use error::{CanrushError, Result};

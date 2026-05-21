use serde::Serialize;

#[derive(Debug, Serialize)]
struct SerialPortDto {
    port_name: String,
    port_type: String,
}

#[tauri::command]
fn list_serial_ports() -> Result<Vec<SerialPortDto>, String> {
    canrush_core::adapter::list_serial_devices()
        .map(|devices| {
            devices
                .into_iter()
                .map(|device| SerialPortDto {
                    port_name: device.port_name,
                    port_type: device.port_type,
                })
                .collect()
        })
        .map_err(|error| error.to_string())
}

fn main() {
    if let Err(error) = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![list_serial_ports])
        .run(tauri::generate_context!())
    {
        eprintln!("failed to run CANRush desktop app: {error}");
        std::process::exit(1);
    }
}

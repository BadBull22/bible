//! Keeping in step with the computer over the home Wi-Fi (since 0.4.0): the phone finds the
//! computer on the network (it answers a broadcast), pairs once with the six-digit code the
//! computer shows, and then sends its sync file and takes the computer's in return. The
//! computer's side is the desktop app's `lan.rs`; the merging is the shared engine's.

use std::net::UdpSocket;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::json;

pub const PORT: u16 = 47810;
const FIND: &[u8] = b"BIBLE-CONCORDANCE-FIND";

/// A computer that answered.
#[derive(Serialize, Clone, Debug)]
pub struct Found {
    pub id: String,
    pub name: String,
    /// "192.168.8.20:47810"
    pub address: String,
}

/// The phone's own address on the Wi-Fi (nothing is sent to find it).
fn local_ip() -> Option<std::net::Ipv4Addr> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    match s.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(a) => Some(a),
        _ => None,
    }
}

/// The computers on this network with the app open and the phone allowed (about 1.5 s).
pub fn find() -> Vec<Found> {
    let mut out: Vec<Found> = Vec::new();
    let Ok(s) = UdpSocket::bind("0.0.0.0:0") else { return out };
    let _ = s.set_broadcast(true);
    let _ = s.set_read_timeout(Some(Duration::from_millis(250)));
    let mut targets = vec![format!("255.255.255.255:{PORT}")];
    // the Wi-Fi's own broadcast address too (some routers pass only that), assuming a /24 network
    if let Some(ip) = local_ip() {
        let o = ip.octets();
        targets.push(format!("{}.{}.{}.255:{PORT}", o[0], o[1], o[2]));
    }
    let until = Instant::now() + Duration::from_millis(1500);
    let mut next_send = Instant::now();
    let mut buf = [0u8; 256];
    while Instant::now() < until {
        if Instant::now() >= next_send {
            for t in &targets {
                let _ = s.send_to(FIND, t);
            }
            next_send = Instant::now() + Duration::from_millis(500);
        }
        if let Ok((n, from)) = s.recv_from(&mut buf) {
            let text = String::from_utf8_lossy(&buf[..n]).to_string();
            let mut parts = text.splitn(4, ' ');
            if parts.next() != Some("BIBLE-CONCORDANCE") {
                continue;
            }
            let (Some(id), Some(port), Some(name)) = (parts.next(), parts.next(), parts.next()) else { continue };
            if !out.iter().any(|f| f.id == id) {
                out.push(Found { id: id.to_string(), name: name.trim().to_string(), address: format!("{}:{}", from.ip(), port) });
            }
        }
    }
    out
}

/// An address as typed ("192.168.8.20") with the port.
pub fn with_port(address: &str) -> String {
    let a = address.trim().trim_start_matches("http://").trim_end_matches('/');
    if a.contains(':') {
        a.to_string()
    } else {
        format!("{a}:{PORT}")
    }
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(4)).timeout(Duration::from_secs(60)).build()
}

/// The computer's answer, or what went wrong in words. `unreachable` tells apart "not on
/// this network" (try finding it again) from the computer saying no.
pub struct Failure {
    pub message: String,
    pub unreachable: bool,
}

fn failure(e: ureq::Error) -> Failure {
    match e {
        ureq::Error::Status(_, resp) => {
            let text = resp.into_string().unwrap_or_default();
            let message = serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from))
                .unwrap_or_else(|| "The computer didn't accept the request.".into());
            Failure { message, unreachable: false }
        }
        _ => Failure {
            message: "Your computer wasn't found on this Wi-Fi. It syncs when the phone is on your home Wi-Fi and Bible Concordance is open on the computer.".into(),
            unreachable: true,
        },
    }
}

#[derive(Deserialize)]
struct Hello {
    id: String,
    name: String,
}

/// Asks the computer at a typed address who it is.
pub fn hello(address: &str) -> Result<Found, Failure> {
    let a = with_port(address);
    let text = agent().get(&format!("http://{a}/hello")).call().map_err(failure)?.into_string().unwrap_or_default();
    let h: Hello = serde_json::from_str(&text).map_err(|_| Failure { message: "That address isn't Bible Concordance on a computer.".into(), unreachable: false })?;
    Ok(Found { id: h.id, name: h.name, address: a })
}

#[derive(Deserialize)]
pub struct Paired {
    pub token: String,
    /// the computer's id and name
    pub id: String,
    pub name: String,
}

/// Pairs this phone with the computer, with the code it shows.
pub fn pair(address: &str, code: &str, my_id: &str, my_name: &str) -> Result<Paired, Failure> {
    let code: String = code.chars().filter(|c| c.is_ascii_digit()).collect();
    let text = agent()
        .post(&format!("http://{}/pair", with_port(address)))
        .set("Content-Type", "application/json")
        .send_string(&json!({ "code": code, "id": my_id, "name": my_name }).to_string())
        .map_err(failure)?
        .into_string()
        .unwrap_or_default();
    serde_json::from_str(&text).map_err(|_| Failure { message: "The computer's answer couldn't be read.".into(), unreachable: false })
}

/// Sends the phone's sync file; returns the computer's.
pub fn exchange(address: &str, token: &str, mine: &str) -> Result<String, Failure> {
    agent()
        .post(&format!("http://{}/sync", with_port(address)))
        .set("Authorization", &format!("Bearer {token}"))
        .set("Content-Type", "application/json")
        .send_string(mine)
        .map_err(failure)?
        .into_string()
        .map_err(|e| Failure { message: format!("The computer's answer couldn't be read ({e})."), unreachable: false })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Against a running desktop app: LAN_TOKEN (a paired test phone's token), LAN_FILE.
    #[test]
    #[ignore]
    fn exchange_with_a_running_computer() {
        let token = std::env::var("LAN_TOKEN").unwrap();
        let file = std::fs::read_to_string(std::env::var("LAN_FILE").unwrap()).unwrap();
        let resp = agent().post("http://127.0.0.1:47810/sync").set("Authorization", &format!("Bearer {token}")).send_string(&file);
        match resp {
            Ok(r) => {
                let mut s = String::new();
                let res = std::io::Read::read_to_string(&mut r.into_reader(), &mut s);
                println!("read: {:?}, {} bytes", res.err(), s.len());
            }
            Err(e) => println!("error: {e}"),
        }
    }

    #[test]
    fn addresses_get_the_port() {
        assert_eq!(with_port("192.168.8.20"), "192.168.8.20:47810");
        assert_eq!(with_port(" http://192.168.8.20:5000/ "), "192.168.8.20:5000");
    }
}

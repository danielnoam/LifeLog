// Google sign-in for Drive backups (src/drive.js). Google won't send a
// sign-in back to the app's own window, so the page opens Google in the
// browser with redirect_uri http://127.0.0.1:<port>, and this answers that
// one request: it hands the page the query (code and state, which the page
// checks) and tells the browser tab it can close. Only 127.0.0.1, never
// the network, and the port is a new one each time.
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct Loopback(pub Mutex<Option<TcpListener>>);

const WAIT: Duration = Duration::from_secs(300);
const PAGE: &str = "<!doctype html><meta charset=utf-8><title>LifeLog</title>\
<body style=\"font:16px system-ui;background:#11141a;color:#e6e8ee;display:grid;place-items:center;height:90vh\">\
<p>Signed in. You can close this tab and go back to LifeLog.</p>";

pub fn listen(state: &Loopback) -> Result<u16, String> {
    let l = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = l.local_addr().map_err(|e| e.to_string())?.port();
    *state.0.lock().map_err(|e| e.to_string())? = Some(l);
    Ok(port)
}

pub fn take(state: &Loopback) -> Result<TcpListener, String> {
    state.0.lock().map_err(|e| e.to_string())?.take().ok_or_else(|| "Not listening".to_string())
}

// The query of the first request for "/?…", or an error after five
// minutes. Other requests (a favicon) get a 404 and are waited past. Off
// the main thread: it blocks.
pub fn wait(l: TcpListener) -> Result<String, String> {
    l.set_nonblocking(true).map_err(|e| e.to_string())?;
    let until = Instant::now() + WAIT;
    while Instant::now() < until {
        match l.accept() {
            Ok((mut s, _)) => {
                let _ = s.set_nonblocking(false);
                let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
                let mut buf = [0u8; 8192];
                let n = s.read(&mut buf).unwrap_or(0);
                let head = String::from_utf8_lossy(&buf[..n]);
                let target = head.split_whitespace().nth(1).unwrap_or("");
                if let Some(q) = target.strip_prefix("/?") {
                    let _ = write!(s, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", PAGE.len(), PAGE);
                    return Ok(q.to_string());
                }
                let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(150)),
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("Timed out".into())
}

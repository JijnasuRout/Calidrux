"""Application entry point — FastAPI + pywebview."""

from __future__ import annotations

import socket
import sys
import threading
import time
import webbrowser

PORT = 8765


def _port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.1)
        return s.connect_ex(("127.0.0.1", port)) == 0


def _wait_for_server(port: int, timeout: float = 20.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _port_in_use(port):
            return True
        time.sleep(0.15)
    return False


def _run_server() -> None:
    import uvicorn
    from calidrux.api.app import create_app
    uvicorn.run(create_app(), host="127.0.0.1", port=PORT, log_level="error")


def main() -> None:
    from calidrux.db.session import init_db
    from calidrux.seed import seed_if_empty

    init_db()
    seed_if_empty()

    t = threading.Thread(target=_run_server, daemon=True)
    t.start()

    if not _wait_for_server(PORT):
        sys.exit("Calidrux: API server failed to start.")

    url = f"http://127.0.0.1:{PORT}"

    try:
        import webview
        webview.create_window(
            "Calidrux — Pharmaceutical Warehouse Optimizer",
            url,
            width=1300,
            height=820,
            min_size=(1024, 600),
        )
        webview.start()
    except Exception:
        webbrowser.open(url)
        print(f"Calidrux running at {url}  (press Ctrl+C to stop)")
        try:
            t.join()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()

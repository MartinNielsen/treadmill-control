# treadmill-control

Send Bluetooth commands to an FTMS treadmill from a web page.

## Camera-assisted timing

The optional camera timer runs entirely in the browser. It reads periodic JPEG snapshots from a go2rtc stream, detects the `person` class with a self-hosted MediaPipe EfficientDet-Lite0 model, and starts or stops walking-session timing without operating the treadmill belt.

For a go2rtc stream such as:

```text
http://teslamate2host:1984/api/stream.mjpeg?src=printer_cam
```

the app automatically requests snapshots from:

```text
http://teslamate2host:1984/api/frame.jpeg?src=printer_cam&width=640
```

The browser must be allowed to read the snapshot response. Add CORS permission to the go2rtc API configuration and restart go2rtc:

```yaml
api:
  listen: "0.0.0.0:1984"
  origin: "*"
```

If prompted, also grant the page permission to access devices on the local network. Camera settings and the selected treadmill region are stored only in the current browser.

## Tests

```bash
node --test tests/camera-utils.test.mjs
```

# treadmill-control

Send Bluetooth commands to an FTMS treadmill from a web page.

## Camera-assisted timing

The optional camera monitor runs entirely in the browser. It reads periodic JPEG snapshots from a go2rtc stream and detects the `person` class with a self-hosted MediaPipe EfficientDet-Lite0 model. Timing works without belt control; an explicit automatic-control arm can also true-stop the belt when the treadmill is empty and start/resume it when a person returns.

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

If prompted, also grant the page permission to access devices on the local network. Camera settings and the selected treadmill region are stored only in the current browser. Automatic belt control is deliberately disarmed on page load and requires an active Bluetooth connection. A camera-triggered empty result sends FTMS Stop (`0x08` with parameter `0x01`) so the belt stops completely; the browser keeps the walking session open and resumes it with Start or Resume (`0x07`) when presence returns.

## Tests

```bash
node --test tests/camera-utils.test.mjs tests/camera-belt-controller.test.mjs
```

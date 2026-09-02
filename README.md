# treadmill-control

Send Bluetooth commands to an FTMS treadmill from a web page.

## Camera-assisted timing

The optional camera monitor runs entirely in the browser. It reads fresh, cache-busted JPEG snapshots from a go2rtc stream and detects the `person` class with a self-hosted MediaPipe EfficientDet-Lite0 model. Timing works without belt control; an explicit automatic-control arm can also true-stop the belt when the treadmill is empty and start/resume it when a person returns. Person detection requires two consecutive strong positive frames; while confirming a person, frames are sampled about every 200 ms, then the normal 500 ms cadence resumes after occupancy is confirmed. Once occupied, weak person detections preserve presence but cannot start the belt, and empty detection requires twelve consecutive hard-empty frames. Each positive stable frame reconciles the belt and reasserts the target speed if telemetry shows it slowing down. Camera-controlled stops finalize the current walking session, and the next camera-controlled start resumes that same session using the normal distance/time accumulation flow.

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

The browser console records timestamped detector results, including confidence, stable-state counters, frame dimensions, capture/inference timing, and repeated-image fingerprints. Open Detection diagnostics in the camera panel for the live summary or to download the last 240 camera events as JSON. A confirmed occupied state is intentionally shown separately from the current frame: a `0%` current frame means the latest image had no person signal; it does not mean the stable state was confirmed at `0%`.

### Debugging a false pause

1. Deploy the new version, connect the treadmill, preview the camera, select the treadmill area, and enable timing.
2. Open Detection diagnostics before starting a normal walk. Leave the page visible while automatic belt control is armed.
3. Walk for at least ten minutes. If the belt pauses while you are still there, download diagnostics immediately and note the last frame number, current signal, stable state, image comparison, and timing.
4. Step completely off the treadmill and verify that it stops only after the hard-empty confirmation window. Return to the treadmill and verify that two strong person frames start/resume it.

The diagnostic file does not contain camera images or credentials. It is intended to be shared when a false pause needs analysis.

## Tests

```bash
node --test tests/camera-utils.test.mjs tests/camera-belt-controller.test.mjs
```

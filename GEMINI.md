# Project: Treadmill Control

## Project Overview

This project is a single-page web application designed to control a Bluetooth-enabled treadmill from a web browser. It utilizes the Web Bluetooth API to communicate with treadmills that implement the Fitness Machine Service (FTMS, UUID `0x1826`).

The application provides the following functionalities:
-   Connecting to and disconnecting from a treadmill.
-   Starting and stopping the treadmill belt.
-   Adjusting the speed of the treadmill.
-   Setting a target speed that is saved in the browser's `localStorage`.
-   Displaying the current speed and other device information.

The entire application is self-contained in the `index.html` file, which includes the HTML structure, CSS styling, and JavaScript logic.

## Building and Running

This is a static web project and does not require a build process. To run the application, you need to serve the `index.html` file over a secure (HTTPS) connection, as the Web Bluetooth API requires it.

You can use any simple web server that supports HTTPS. For example, you can use the `live-server` npm package:

```bash
# Install live-server globally
npm install -g live-server

# Serve the current directory over HTTPS
live-server --https
```

Alternatively, you can use Python's built-in HTTP server, but you would need to set up HTTPS separately.

## Development Conventions

-   **Frameworks:** The project is written in vanilla JavaScript, with no external frameworks or libraries.
-   **File Structure:** All code (HTML, CSS, and JavaScript) is located in the `index.html` file.
-   **Bluetooth Communication:** The application uses the Web Bluetooth API to interact with the treadmill. The communication logic is based on the FTMS protocol, using specific service and characteristic UUIDs.
-   **Code Style:** The JavaScript code is written in an asynchronous style, using `async/await` for handling Bluetooth operations.
-   **Configuration:** The target speed is stored in the browser's `localStorage` under the key `targetSpeed`.

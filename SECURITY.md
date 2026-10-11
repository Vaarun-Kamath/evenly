# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability
reporting: go to the **Security** tab of this repository and choose **Report a vulnerability**.

Include what you found, how to reproduce it, and which version or commit you tested. You can expect
an acknowledgement within a few days. Once a fix is released, we are happy to credit you if you wish.

## Supported versions

Only the latest release receives security fixes while the project is below 1.0.

## Scope notes

Evenly stores passwords hashed, session tokens only as hashes, and sends no telemetry. The security
baseline the project follows is described in [docs/PLATFORM.md](docs/PLATFORM.md) section 6.

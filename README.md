DogOps
===
## Usage
- pull - Pull all dogops managed alerts
    ```bash
    bun dogops.min.js pull
    ```
- status - See the status of datadog alerts
    ```bash
    bun dogops.min.js status
    ```

## Build
This project can run with bun and nodejs

Install [bun](https://bun.sh/)
```bash
curl -fsSL https://bun.sh/install | bash
```
Then
```bash
bun install && bun run build
```


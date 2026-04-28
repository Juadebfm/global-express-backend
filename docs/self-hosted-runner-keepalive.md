# Self-Hosted Runner Setup for Render Keepalive

Use this when you want `Render Keepalive` to run without depending on GitHub-hosted runner minutes.

## 1) Add a runner in GitHub

1. Open your repository on GitHub.
2. Go to `Settings` -> `Actions` -> `Runners`.
3. Click `New self-hosted runner`.
4. Choose your OS and copy the commands GitHub provides.

## 2) Install runner on an always-on machine

Run the provided commands on a machine that stays online (VPS, home server, etc.):

```bash
mkdir actions-runner && cd actions-runner
curl -o actions-runner-linux-x64-<version>.tar.gz -L <github-runner-download-url>
tar xzf ./actions-runner-linux-x64-<version>.tar.gz
./config.sh --url https://github.com/<owner>/<repo> --token <token>
```

## 3) Run as a service

```bash
sudo ./svc.sh install
sudo ./svc.sh start
```

Check status:

```bash
sudo ./svc.sh status
```

## 4) Verify keepalive workflow

1. In GitHub, open `Actions` -> `Render Keepalive`.
2. Click `Run workflow`.
3. Confirm the run is picked by your self-hosted runner and returns HTTP 2xx.

## 5) Important note about interval

Render free web services can spin down after about 15 minutes of inactivity.  
If your schedule is every `30` or `60` minutes, this acts as a periodic health check, not a strict keep-awake mechanism.

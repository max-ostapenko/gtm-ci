# GTM publishing assistant

Enhance collaboration, manage accesses and make publishing operations more reliable

# Slack integration

[Webhook configuration](https://XXXXXXXXXXXX.slack.com/services/1256695779699)

## Development

1 Read [an official Tag Manager documentation](https://developers.google.com/tag-manager/api/v2)

2a Setup Linux environment

```bash
bash ./dev/env_config.sh
```

2b Windows:

- [Install NodeJS and NPM](https://nodejs.org/en/download/current/)
- `npm install`

3 Save Google Service Account credentials in `credentials.json` in parent directory.
4 Set environment variables:

```bash
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
```

5 Run the pipeline

```bash
node src/index.js --account=1234567890 --container=1234567890
```

TODO:

1. Need to resolve prettier issue on Windows and add `husky` to dev dependencies

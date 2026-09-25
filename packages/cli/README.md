# @cellflow/cli

Zero-dependency operator CLI for a deployed CellFlow instance.

```bash
export CELLFLOW_ENDPOINT=http://localhost:3000
export CELLFLOW_API_KEY=cf_live_...

npm exec --workspace @cellflow/cli -- cellflow doctor
npm exec --workspace @cellflow/cli -- cellflow intents
npm exec --workspace @cellflow/cli -- cellflow intent transfer-1042
npm exec --workspace @cellflow/cli -- cellflow reconcile transfer-1042
npm exec --workspace @cellflow/cli -- cellflow evidence transfer-1042 > evidence.json
npm exec --workspace @cellflow/cli -- cellflow keys
npm exec --workspace @cellflow/cli -- cellflow key-create deploy-bot
npm exec --workspace @cellflow/cli -- cellflow key-revoke <key-id>
```

The CLI never needs `CELLFLOW_ENCRYPTION_KEY` or `CELLFLOW_BOOTSTRAP_TOKEN`; those remain server/operator bootstrap secrets.

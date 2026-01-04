# Run with Cron

```
0 * * * * cd /path/to/this/repo/on/your/machine && /usr/bin/env bash -c 'export $(cat .env | xargs) && npx ts-node src/index.ts >> logs/cron.log 2>&1'
```

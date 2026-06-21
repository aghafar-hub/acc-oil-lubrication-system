# Data extraction scripts

`extract_seed_from_excel.py` reads the original
`ACC_Lubricants_Master_v2.xlsx` master file and produces the JSON seed
data committed under `backend/prisma/seed-data/`. It is not part of the
running application — re-run it only if the source spreadsheet changes
and you need to regenerate the seed data (point the script at the new
file path and re-run `npm run db:seed` afterward).

const path = require("path");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function normalizeCurrencyValue(value) {
  if (value === null || value === undefined) return value;

  return String(value)
    .replace(/Γé╣|â‚¹|₹/g, "₹")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing from backend-vps/.env");
  }

  const connection = await mysql.createConnection(process.env.DATABASE_URL);

  try {
    const [rows] = await connection.query(
      "SELECT id, title, price, registration_fee FROM batches WHERE price IS NOT NULL OR registration_fee IS NOT NULL"
    );

    let updated = 0;
    for (const row of rows) {
      const nextPrice = normalizeCurrencyValue(row.price);
      const nextRegistrationFee = normalizeCurrencyValue(row.registration_fee);

      if (nextPrice === row.price && nextRegistrationFee === row.registration_fee) {
        continue;
      }

      await connection.execute(
        "UPDATE batches SET price = ?, registration_fee = ? WHERE id = ?",
        [nextPrice, nextRegistrationFee, row.id]
      );
      updated += 1;
      console.log(`Updated ${row.id} (${row.title})`);
    }

    console.log(`Done. Updated ${updated} batch row(s).`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

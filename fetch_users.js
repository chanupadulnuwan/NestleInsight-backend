const { Client } = require('pg');

const client = new Client({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'ccashwinth',
  database: 'nestle_db'
});

async function main() {
  try {
    await client.connect();
    const result = await client.query('SELECT username, email, "platformAccess", role, "warehouseName" FROM users WHERE role IN (\'TERRITORY_DISTRIBUTOR\', \'REGIONAL_MANAGER\')');
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (err) {
    if (err.message.includes('column')) {
       // if column platformAccess is not there, try without it
       try {
          const res2 = await client.query('SELECT username, email, role FROM users WHERE role IN (\'TERRITORY_DISTRIBUTOR\', \'REGIONAL_MANAGER\')');
          console.log(JSON.stringify(res2.rows, null, 2));
       } catch (err2) {
          console.error(err2);
       }
    } else {
       console.error(err);
    }
  } finally {
    await client.end();
  }
}

main();

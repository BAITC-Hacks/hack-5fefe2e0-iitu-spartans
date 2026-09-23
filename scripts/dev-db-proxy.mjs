import net from "node:net";

// Pass-through TCP only: PostgreSQL authentication and protocol remain intact.
// Resolve `db` for each new connection so Compose may recreate it freely.
const server = net.createServer((client) => {
  const upstream = net.connect({ host: "db", port: 5432 });
  client.pipe(upstream);
  upstream.pipe(client);
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
  client.on("close", () => upstream.destroy());
  upstream.on("close", () => client.destroy());
});
server.listen(5432, "0.0.0.0");

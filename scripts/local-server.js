import { createServer } from "node:http";
import handler from "../index.js";

const port = Number(process.env.PORT || 4173);
const server = createServer((req, res) => handler(req, res));

server.listen(port, "127.0.0.1", () => {
  console.log(`Airport Navigator running at http://127.0.0.1:${port}`);
});

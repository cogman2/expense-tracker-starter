import express from "express";

export interface ApiHealth {
  status: "ok";
  service: string;
  timestamp: string;
}

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.use(express.json());

app.get("/health", (_req, res) => {
  const body: ApiHealth = {
    status: "ok",
    service: "helpdesk-server",
    timestamp: new Date().toISOString(),
  };
  res.json(body);
});

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});

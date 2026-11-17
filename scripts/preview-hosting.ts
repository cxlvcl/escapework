import "dotenv/config";
process.env.ESCAPE_HOSTING_PREVIEW = "1";
void import("../tests/hosting/environment").then(({ startHosting }) =>
  startHosting(true),
);

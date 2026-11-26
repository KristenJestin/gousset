import { createUser, expect, personOfItsOwn, signInStatus, test } from "../src/test";

// Issue #245: behind a reverse proxy, an installation names it in TRUSTED_PROXIES, and the app then
// counts failed sign-ins against the address the proxy forwards (`X-Forwarded-For`), not against the
// proxy's own, which every client shares. The app must read the value it is started with, not the
// one it was built with: built in, it stayed empty and the forwarded address was never read. The
// worker's app is started behind the harness's own address, 127.0.0.1, as its proxy; without a
// trusted proxy, `auth.spec.ts` checks that a forwarded address buys no fresh attempts.

test.use({ appEnvironment: { TRUSTED_PROXIES: "127.0.0.1" } });

test("behind a trusted proxy, failed sign-ins are counted per forwarded address", async ({
  app,
  user,
}) => {
  const person = personOfItsOwn("quentin");

  await createUser(app.baseURL, user, person);

  const wrong = { email: person.email, password: "not-the-password" };

  // Five failures from one address behind the proxy: that address is refused, the right password too.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    expect(await signInStatus(app.baseURL, wrong, "198.51.100.1")).toBe(401);
  }

  expect(await signInStatus(app.baseURL, person, "198.51.100.1")).toBe(429);

  // Another address behind the same proxy is counted apart: the owner still signs in from it.
  expect(await signInStatus(app.baseURL, person, "198.51.100.2")).toBe(200);
});

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

export const userRoutes = new Hono({ strict: false });

export interface User {
  id: string;
  name: string;
  email: string;
}

const MOCK_USERS: User[] = [
  { id: "1", name: "Alice Smith", email: "alice@example.com" },
  { id: "2", name: "Bob Jones", email: "bob@example.com" },
];

userRoutes.get("/", (c) => {
  return c.json(MOCK_USERS);
});

userRoutes.post("/", async (c) => {
  const body = await c.req.json<Partial<User>>().catch(() => null);

  if (!body?.email) {
    throw new HTTPException(400, { message: "email is required" });
  }

  const user: User = {
    id: String(MOCK_USERS.length + 1),
    name: body.name ?? "",
    email: body.email,
  };
  MOCK_USERS.push(user);

  return c.json(user, 201);
});

userRoutes.get("/:userId", (c) => {
  const userId = c.req.param("userId");
  const user = MOCK_USERS.find((u) => u.id === userId);

  if (!user) {
    throw new HTTPException(404, { message: "User not found" });
  }

  return c.json(user);
});

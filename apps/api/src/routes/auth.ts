import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().min(1).max(60),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function publicUser(u: {
  id: string;
  email: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  theme: string;
}) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    bio: u.bio,
    avatarUrl: u.avatarUrl,
    theme: u.theme,
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0].message });
    }
    const { email, password, displayName } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(409).send({ error: "An account with that email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 12); // BRD NF16: bcrypt cost 12
    const user = await prisma.user.create({
      data: { email, passwordHash, displayName },
    });

    const token = await reply.jwtSign({ sub: user.id, email: user.email }, { expiresIn: "7d" });
    return reply.code(201).send({ token, user: publicUser(user) });
  });

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid email or password" });
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    const token = await reply.jwtSign({ sub: user.id, email: user.email }, { expiresIn: "7d" });
    return reply.send({ token, user: publicUser(user) });
  });

  app.get("/api/auth/me", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
    if (!user) return reply.code(404).send({ error: "User not found" });
    return reply.send({ user: publicUser(user) });
  });

  app.patch("/api/auth/me", { preHandler: [app.authenticate] }, async (request, reply) => {
    const schema = z.object({
      displayName: z.string().min(1).max(60).optional(),
      bio: z.string().max(280).optional(),
      theme: z.enum(["light", "dark"]).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });

    const user = await prisma.user.update({
      where: { id: request.user.sub },
      data: parsed.data,
    });
    return reply.send({ user: publicUser(user) });
  });
}

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Dev seed

`npm run seed:dev` populates the development database with a fixed cast for
manual testing: 6 tutors (featured / premium / verified / free / incomplete /
suspended), 4 parents (unverified / verified / featured / hired), 5 jobs, 4
applications, a thread whose message contains a phone number (for the number
masking work), a pending demo request, subscriptions including one expiring in
2 days, and profile views.

All seed accounts use the password `Test1234!` and emails of the form
`seed+<name>@tutormint.dev`, e.g. `seed+featured-ali@tutormint.dev`.

The script is idempotent: each run first deletes exactly the `seed+*` users,
and FK cascades from `auth.users` remove their data. Nothing else is touched.

**It refuses to run** unless `NODE_ENV` is not `production` **and** both
`SUPABASE_DB_URL` and `NEXT_PUBLIC_SUPABASE_URL` point at the known dev
project ref. This is what stops it ever reaching another project's data.

It requires `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. Email confirmation
is on and the project has no SMTP sender configured, so `auth.signUp()` fails
with "Error sending confirmation email"; the seed instead uses
`auth.admin.createUser({ email_confirm: true })`, which creates confirmed
users without sending mail. The key is **server-only** — never give it a
`NEXT_PUBLIC_` prefix and never import it into client code.

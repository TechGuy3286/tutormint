import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");

    if (!email) {
      return NextResponse.json({ error: "Email parameter is required" }, { status: 400 });
    }

    const client = typeof clientPromise === "function" ? await clientPromise() : await clientPromise;
    const db = client.db("tutormint");
    const parent = await db.collection("parents").findOne({ email: email.toLowerCase().trim() });

    if (!parent) {
      return NextResponse.json({ error: "Parent profile not found" }, { status: 404 });
    }

    return NextResponse.json({ parent }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, fullName } = body;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const client = typeof clientPromise === "function" ? await clientPromise() : await clientPromise;
    const db = client.db("tutormint");

    const existing = await db.collection("parents").findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return NextResponse.json({ parent: existing }, { status: 200 });
    }

    const newParent = {
      email: email.toLowerCase().trim(),
      fullName: fullName || "Client / Parent",
      createdAt: new Date(),
    };

    const result = await db.collection("parents").insertOne(newParent);
    return NextResponse.json({ parent: { _id: result.insertedId, ...newParent } }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
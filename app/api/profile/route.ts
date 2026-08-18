import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");

    if (!email) {
      return NextResponse.json({ error: "Email parameter is required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db("tutormint");
    const tutor = await db.collection("tutors").findOne({ email: email.toLowerCase().trim() });

    if (!tutor) {
      return NextResponse.json({ error: "Tutor profile not found" }, { status: 404 });
    }

    return NextResponse.json({ tutor }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
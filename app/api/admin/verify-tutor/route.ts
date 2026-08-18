import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { email, status } = body;

    if (!email || !status) {
      return NextResponse.json({ error: "Email and status are required" }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db("tutormint");

    const result = await db.collection("tutors").updateOne(
      { email: email.toLowerCase().trim() },
      { $set: { profileCompletionStatus: status, verifiedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Tutor not found in database" }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: `Tutor ${email} verified successfully` }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
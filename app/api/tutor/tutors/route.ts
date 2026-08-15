import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Tutor from "@/lib/models/Tutor";

export async function GET() {
  try {
    await connectDB();
    const tutors = await Tutor.find({}).sort({ createdAt: -1 });

    return NextResponse.json({ tutors }, { status: 200 });
  } catch (error: any) {
    console.error("Admin Fetch Tutors Error:", error);
    return NextResponse.json({ error: "Failed to fetch tutors" }, { status: 500 });
  }
}
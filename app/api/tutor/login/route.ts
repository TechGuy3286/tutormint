import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Tutor from "@/lib/models/Tutor";

export async function POST(req: Request) {
  try {
    await connectDB();
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Email address is required" }, { status: 400 });
    }

    const tutor = await Tutor.findOne({ email: email.trim().toLowerCase() });
    if (!tutor) {
      return NextResponse.json({ error: "Tutor profile not found. Please register first." }, { status: 404 });
    }

    return NextResponse.json({ message: "Login successful", tutor }, { status: 200 });
  } catch (error: any) {
    console.error("Tutor Login Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
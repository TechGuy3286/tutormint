import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Tutor from "@/lib/models/Tutor";

export async function GET(req: Request) {
  try {
    await connectDB();
    const { searchParams } = new URL(req.url);
    const email = searchParams.get("email");

    if (!email) {
      return NextResponse.json({ error: "Email query parameter is required" }, { status: 400 });
    }

    const tutor = await Tutor.findOne({ email });
    if (!tutor) {
      return NextResponse.json({ error: "Tutor profile not found" }, { status: 404 });
    }

    return NextResponse.json({ tutor }, { status: 200 });
  } catch (error: any) {
    console.error("Fetch Tutor Profile Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
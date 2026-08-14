import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Tutor from "@/lib/models/Tutor";

export async function POST(req: Request) {
  try {
    await connectDB();
    const { email, cnic } = await req.json();

    const tutor = await Tutor.findOne({ email, cnic });

    if (!tutor) {
      return NextResponse.json(
        { error: "Invalid email or CNIC. Please check your credentials." },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { message: "Login successful", tutor },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Login Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
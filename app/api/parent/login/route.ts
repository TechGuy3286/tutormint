import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Parent from "@/lib/models/Parent";

export async function POST(req: Request) {
  try {
    await connectDB();
    const { email } = await req.json();

    const parent = await Parent.findOne({ email });

    if (!parent) {
      return NextResponse.json(
        { error: "Parent account not found with this email." },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { message: "Login successful", parent },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Parent Login Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import ActivityLog from "@/lib/models/ActivityLog";

// POST: Record a new tutor activity
export async function POST(req: Request) {
  try {
    await connectDB();
    const { tutorId, action, description, metadata } = await req.json();

    if (!tutorId || !action || !description) {
      return NextResponse.json({ error: "Missing required activity fields" }, { status: 400 });
    }

    const log = await ActivityLog.create({
      tutorId,
      action,
      description,
      metadata,
    });

    return NextResponse.json({ message: "Activity logged successfully", log }, { status: 201 });
  } catch (error: any) {
    console.error("Log Activity Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}

// GET: Fetch activities for a specific tutor (for admin or tutor dashboard)
export async function GET(req: Request) {
  try {
    await connectDB();
    const { searchParams } = new URL(req.url);
    const tutorId = searchParams.get("tutorId");

    if (!tutorId) {
      return NextResponse.json({ error: "tutorId query parameter is required" }, { status: 400 });
    }

    const logs = await ActivityLog.find({ tutorId }).sort({ createdAt: -1 }).limit(100);

    return NextResponse.json({ logs }, { status: 200 });
  } catch (error: any) {
    console.error("Fetch Activity Logs Error:", error);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
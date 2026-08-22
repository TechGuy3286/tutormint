import connectDB from "@/lib/mongodb";
import Tutor from "@/lib/models/Tutor";
import { notFound } from "next/navigation";
import Link from "next/link";

interface PageProps {
  params: Promise<{ username: string }>;
}

export default async function TutorProfilePage({ params }: PageProps) {
  const { username } = await params;
  
  await connectDB();
  const tutor = await Tutor.findOne({ username });

  if (!tutor) {
    notFound();
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 flex-1 w-full text-[#334155]">
      {/* Profile Header Card */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-200 p-6 sm:p-10 space-y-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 text-center sm:text-left">
          <div className="w-20 h-20 rounded-2xl bg-[#0F172A] text-white flex items-center justify-center text-3xl font-black shadow-md shrink-0">
            {tutor.fullName ? tutor.fullName.charAt(0) : "T"}
          </div>
          <div className="space-y-1.5 flex-1">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
              <h1 className="text-2xl font-black text-[#0F172A]">{tutor.fullName}</h1>
              {tutor.status === "active" ? (
                <span className="px-2.5 py-0.5 bg-emerald-50 text-[#059669] border border-emerald-200 text-[10px] font-bold rounded-full uppercase">
                  ✓ Camera Verified
                </span>
              ) : (
                <span className="px-2.5 py-0.5 bg-amber-50 text-amber-600 border border-amber-200 text-[10px] font-bold rounded-full uppercase">
                  ⏳ Verification Pending
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 font-medium">
              {tutor.city || "Pakistan"} • Teaching Mode: <strong className="text-[#0F172A]">{tutor.teachingMode}</strong>
            </p>
            <div className="pt-2 flex flex-wrap gap-1.5 justify-center sm:justify-start">
              {tutor.degrees?.map((deg: string, idx: number) => (
                <span key={idx} className="px-3 py-1 bg-[#F8FAFC] border border-gray-200 text-[11px] font-semibold text-[#334155] rounded-xl">
                  🎓 {deg}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-gray-100">
          <div className="p-4 bg-[#F8FAFC] rounded-2xl border border-gray-100 space-y-1">
            <span className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">Service Location</span>
            <p className="text-xs font-bold text-[#0F172A]">{tutor.areaName || "Main City"}, {tutor.city || tutor.province}</p>
          </div>
          <div className="p-4 bg-[#F8FAFC] rounded-2xl border border-gray-100 space-y-1">
            <span className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">Preferred Platforms</span>
            <p className="text-xs font-bold text-[#0F172A]">
              {tutor.onlinePlatforms?.length ? tutor.onlinePlatforms.join(", ") : "In-Person Home Tuition Available"}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-4 flex flex-col sm:flex-row gap-3">
          {tutor.whatsapp_number || tutor.phone_number ? (
            <a
              href={`https://wa.me/${tutor.whatsapp_number || tutor.phone_number}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-3.5 bg-[#059669] hover:bg-emerald-700 text-white rounded-xl font-bold text-xs text-center shadow-md transition-all flex items-center justify-center gap-2"
            >
              <span>💬 Contact via WhatsApp</span>
            </a>
          ) : null}
          <Link
            href="/parent/dashboard"
            className="flex-1 py-3.5 bg-[#0F172A] hover:bg-slate-800 text-white rounded-xl font-bold text-xs text-center shadow-md transition-all flex items-center justify-center gap-2"
          >
            <span>📋 Request Custom Tuition Job</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
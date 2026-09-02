export function generateWhatsAppShareLink(tutor: {
  name: string;
  title: string;
  description: string;
  profileUrl: string;
  imageUrl: string;
}) {
  const text = `🌟 *Verified TutorMint Expert Profile* 🌟\n\n` +
    `👤 *Name:* ${tutor.name}\n` +
    `🎯 *Title:* ${tutor.title}\n` +
    `📝 *Bio:* ${tutor.description}\n\n` +
    `🖼️ *Profile Picture:* ${tutor.imageUrl}\n\n` +
    `🔗 *View & Hire Directly:* ${tutor.profileUrl}\n\n` +
    `_No middlemen, 100% direct connection with verified students & parents!_`;

  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

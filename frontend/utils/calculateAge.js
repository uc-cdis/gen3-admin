export default function calculateAge(created) {
    const now = new Date();
    const createdDate = new Date(created);
    const diffTime = Math.abs(now - createdDate);
    const diffMinutes = Math.ceil(diffTime / (1000 * 60));
    if (diffMinutes < 60) return `${diffMinutes}m`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h`;
    return `${Math.floor(diffHours / 24)}d`;
}
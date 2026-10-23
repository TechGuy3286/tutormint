import { loadTeamOverview } from '@/lib/teamOverview'
import TeamOverviewView from '@/components/admin/TeamOverviewView'

// The Team overview card (owner, 24 Oct 2026): loads the rows on the server;
// the markup is TeamOverviewView.
export default async function TeamOverviewCard() {
  return <TeamOverviewView rows={await loadTeamOverview()} />
}

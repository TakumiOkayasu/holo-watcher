/**
 * GitHub Actions Jobs API から失敗した job/step 情報を取得
 */

const MAX_SUMMARY_LENGTH = 800;

interface JobStep {
  name: string;
  conclusion: string;
}

interface Job {
  name: string;
  conclusion: string;
  steps?: JobStep[];
}

/**
 * GitHub API で失敗した job/step を取得し、テキストサマリーを返す
 * @param repo リポジトリ名 (owner/repo)
 * @param runId workflow_run.id
 * @param token GitHub API Token
 * @param fetchFn テスト用fetch差し替え
 * @returns 失敗サマリー文字列、または null (エラー時/失敗なし)
 */
export async function fetchErrorSummary(
  repo: string,
  runId: number,
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<string | null> {
  try {
    const response = await fetchFn(
      `https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'holo-ci-bot',
        },
      }
    );

    if (!response.ok) {
      console.error(
        `GitHub API error: ${response.status} ${response.statusText} for ${repo} run=${runId}`
      );
      return null;
    }

    const data: { jobs: Job[] } = await response.json();
    const failedJobs = data.jobs.filter((job) => job.conclusion === 'failure');

    if (failedJobs.length === 0) {
      return null;
    }

    const lines = ['失敗したステップ:'];
    for (const job of failedJobs) {
      const failedSteps = job.steps?.filter((s) => s.conclusion === 'failure') ?? [];
      if (failedSteps.length > 0) {
        for (const step of failedSteps) {
          lines.push(`- Job "${job.name}" / Step "${step.name}"`);
        }
      } else {
        lines.push(`- Job "${job.name}" / Step "(不明)"`);
      }
    }

    const summary = lines.join('\n');
    return summary.length > MAX_SUMMARY_LENGTH
      ? summary.substring(0, MAX_SUMMARY_LENGTH)
      : summary;
  } catch (error) {
    console.error(`GitHub API fetch failed for ${repo} run=${runId}:`, error);
    return null;
  }
}

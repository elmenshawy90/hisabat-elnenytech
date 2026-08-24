/**
 * Fetches the latest deployment status from Vercel API
 * @returns {Promise<Object>} Deployment status details or error object
 */
async function getLatestDeployment() {
  const apiToken = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;

  if (!apiToken || !projectId) {
    return {
      error: 'تعذر الاتصال بـ Vercel API',
      details: 'تأكد من ضبط VERCEL_API_TOKEN و VERCEL_PROJECT_ID في المتغيرات البيئية'
    };
  }

  try {
    let url = `https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=1`;
    if (teamId && teamId.trim()) {
      url += `&teamId=${encodeURIComponent(teamId.trim())}`;
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiToken.trim()}`
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      return {
        error: 'تعذر الاتصال بـ Vercel API',
        details: `رمز الاستجابة: ${response.status} ${response.statusText} (${errText.substring(0, 100)})`
      };
    }

    const data = await response.json();

    if (!data.deployments || !Array.isArray(data.deployments) || data.deployments.length === 0) {
      return {
        error: 'لم يتم العثور على عمليات نشر (Deployments) لهذا المشروع على Vercel',
        details: 'تأكد من صحة VERCEL_PROJECT_ID'
      };
    }

    const dep = data.deployments[0];
    const state = dep.state || 'UNKNOWN';
    const createdAt = dep.createdAt || dep.created || Date.now();
    const rawUrl = dep.url || '';
    const depUrl = rawUrl ? (rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`) : null;
    const commitMessage = dep.meta?.githubCommitMessage || dep.meta?.commitMessage || dep.meta?.githubCommitSha || null;
    const uid = dep.uid || dep.id;
    const projectName = dep.name || projectId;

    let errorMessage = null;

    if (state === 'ERROR' && uid) {
      try {
        let eventsUrl = `https://api.vercel.com/v13/deployments/${encodeURIComponent(uid)}/events?limit=50`;
        if (teamId && teamId.trim()) {
          eventsUrl += `&teamId=${encodeURIComponent(teamId.trim())}`;
        }

        const eventsRes = await fetch(eventsUrl, {
          headers: {
            Authorization: `Bearer ${apiToken.trim()}`
          }
        });

        if (eventsRes.ok) {
          const events = await eventsRes.json();
          if (Array.isArray(events)) {
            const errEvent = events.slice().reverse().find(e => {
              const text = (e.payload?.text || e.text || e.payload?.info || '').toLowerCase();
              const type = (e.type || e.payload?.type || '').toLowerCase();
              return type.includes('error') || type === 'stderr' || text.includes('error') || text.includes('failed');
            });
            if (errEvent) {
              errorMessage = errEvent.payload?.text || errEvent.text || errEvent.payload?.info || null;
            }
          }
        }
      } catch (err) {
        console.error('[vercel-status] Error fetching deployment events:', err);
      }

      if (!errorMessage) {
        errorMessage = 'فشل النشر - راجع لوحة تحكم Vercel للتفاصيل الكاملة';
      }
    }

    const dashboardUrl = teamId && teamId.trim()
      ? `https://vercel.com/${teamId.trim()}/${projectName}/${uid}`
      : `https://vercel.com/dashboard`;

    return {
      success: true,
      state,
      createdAt,
      url: depUrl,
      commitMessage,
      uid,
      errorMessage,
      dashboardUrl
    };
  } catch (err) {
    console.error('[vercel-status] Fetch error:', err);
    return {
      error: 'تعذر الاتصال بـ Vercel API',
      details: err.message || 'حدث خطأ في الاتصال بالشبكة'
    };
  }
}

module.exports = { getLatestDeployment };

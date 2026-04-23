use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use regex::Regex;
use uuid::Uuid;

use crate::models::channel::ChannelMember;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MentionToken {
    User(Uuid),
    Everyone,
}

fn mention_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"<@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|todos)>")
            .expect("mention regex")
    })
}

/// Replace every `<@uuid>` / `<@todos>` token in `content` with a human-readable
/// `@Name` string, using `name_lookup` (uuid string → display name) to resolve
/// users. Unknown uuids fall back to `@usuário`; the everyone sentinel renders
/// as `@todos`. Use this when writing user-facing content that should NOT show
/// raw tokens — notification previews, email bodies, audit logs, etc.
pub fn render_for_display(content: &str, name_lookup: &HashMap<String, String>) -> String {
    let re = mention_regex();
    re.replace_all(content, |caps: &regex::Captures| {
        let raw = &caps[1];
        if raw.eq_ignore_ascii_case("todos") {
            "@todos".to_string()
        } else {
            let name = name_lookup
                .get(raw)
                .cloned()
                .unwrap_or_else(|| "usuário".to_string());
            format!("@{}", name)
        }
    })
    .into_owned()
}

pub fn parse(content: &str) -> Vec<MentionToken> {
    let re = mention_regex();
    let mut out = Vec::new();
    for cap in re.captures_iter(content) {
        let raw = &cap[1];
        if raw.eq_ignore_ascii_case("todos") {
            out.push(MentionToken::Everyone);
        } else if let Ok(id) = Uuid::parse_str(raw) {
            out.push(MentionToken::User(id));
        }
    }
    out
}

/// Returns the deduplicated list of user_ids that should receive a notification
/// for a message with `tokens`, given the channel's current member list and the
/// sender's id. The sender is always excluded. `@todos` expands to all channel
/// members. User mentions are validated against channel membership — stray
/// uuids of non-members are silently dropped.
pub fn resolve_recipients(
    tokens: &[MentionToken],
    channel_members: &[ChannelMember],
    sender_id: &Uuid,
) -> Vec<Uuid> {
    let member_ids: HashSet<Uuid> = channel_members.iter().map(|m| m.user_id).collect();
    let mut recipients: HashSet<Uuid> = HashSet::new();
    for tok in tokens {
        match tok {
            MentionToken::Everyone => {
                for id in &member_ids {
                    if id != sender_id {
                        recipients.insert(*id);
                    }
                }
            }
            MentionToken::User(id) => {
                if id != sender_id && member_ids.contains(id) {
                    recipients.insert(*id);
                }
            }
        }
    }
    recipients.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn member(user_id: Uuid) -> ChannelMember {
        ChannelMember {
            channel_id: Uuid::nil(),
            user_id,
            workspace_id: Uuid::nil(),
            role: "member".into(),
            last_read_at: None,
            joined_at: Utc::now(),
            user_name: None,
            user_email: None,
        }
    }

    #[test]
    fn parses_single_user_mention() {
        let id = Uuid::new_v4();
        let content = format!("hey <@{}> please", id);
        let tokens = parse(&content);
        assert_eq!(tokens, vec![MentionToken::User(id)]);
    }

    #[test]
    fn parses_todos_mention() {
        let tokens = parse("heads up <@todos>!");
        assert_eq!(tokens, vec![MentionToken::Everyone]);
    }

    #[test]
    fn parses_mixed_mentions() {
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let content = format!("<@{}> and <@{}> and <@todos>", a, b);
        let tokens = parse(&content);
        assert_eq!(
            tokens,
            vec![
                MentionToken::User(a),
                MentionToken::User(b),
                MentionToken::Everyone,
            ]
        );
    }

    #[test]
    fn ignores_malformed() {
        let tokens = parse("hi @someone <@not-a-uuid> <@>");
        assert!(tokens.is_empty());
    }

    #[test]
    fn resolve_excludes_sender_self_mention() {
        let sender = Uuid::new_v4();
        let other = Uuid::new_v4();
        let members = vec![member(sender), member(other)];
        let tokens = vec![MentionToken::User(sender), MentionToken::User(other)];
        let r = resolve_recipients(&tokens, &members, &sender);
        assert_eq!(r, vec![other]);
    }

    #[test]
    fn resolve_todos_expands_to_all_except_sender() {
        let sender = Uuid::new_v4();
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let members = vec![member(sender), member(a), member(b)];
        let mut r = resolve_recipients(&[MentionToken::Everyone], &members, &sender);
        r.sort();
        let mut expected = vec![a, b];
        expected.sort();
        assert_eq!(r, expected);
    }

    #[test]
    fn resolve_drops_non_member_ids() {
        let sender = Uuid::new_v4();
        let stranger = Uuid::new_v4();
        let member_uid = Uuid::new_v4();
        let members = vec![member(sender), member(member_uid)];
        let tokens = vec![MentionToken::User(stranger), MentionToken::User(member_uid)];
        let r = resolve_recipients(&tokens, &members, &sender);
        assert_eq!(r, vec![member_uid]);
    }

    #[test]
    fn render_replaces_tokens_with_names() {
        let id = Uuid::new_v4();
        let mut lookup = HashMap::new();
        lookup.insert(id.to_string(), "João Silva".to_string());
        let content = format!("Oi <@{}>, tudo bem? <@todos>!", id);
        let out = render_for_display(&content, &lookup);
        assert_eq!(out, "Oi @João Silva, tudo bem? @todos!");
    }

    #[test]
    fn render_unknown_uuid_falls_back() {
        let id = Uuid::new_v4();
        let lookup = HashMap::new();
        let content = format!("Olha <@{}>", id);
        let out = render_for_display(&content, &lookup);
        assert_eq!(out, "Olha @usuário");
    }

    #[test]
    fn resolve_dedupes() {
        let sender = Uuid::new_v4();
        let other = Uuid::new_v4();
        let members = vec![member(sender), member(other)];
        let tokens = vec![
            MentionToken::User(other),
            MentionToken::Everyone,
            MentionToken::User(other),
        ];
        let r = resolve_recipients(&tokens, &members, &sender);
        assert_eq!(r, vec![other]);
    }
}

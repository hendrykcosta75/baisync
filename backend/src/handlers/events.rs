use std::convert::Infallible;

use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Extension;
use futures::stream::Stream;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use crate::middleware::auth::AuthUser;
use crate::services::events::EventBus;

pub async fn sse_stream(
    Extension(bus): Extension<EventBus>,
    Extension(auth_user): Extension<AuthUser>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let user_id = auth_user.user_id;
    let rx = bus.subscribe(user_id).await;

    let stream = BroadcastStream::new(rx).filter_map(move |result| {
        match result {
            Ok(sse_event) => Some(Ok(Event::default()
                .event(&sse_event.event_type)
                .data(sse_event.data))),
            Err(_) => None, // Lagged or closed — skip
        }
    });

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(std::time::Duration::from_secs(30))
            .text("keep-alive"),
    )
}

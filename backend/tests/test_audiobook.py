

def test_estimate_weights_proportional_to_length_plus_gap():
    from app.supplemental.media.audiobook import estimate_weights

    w = estimate_weights(["a" * 140, "a" * 280], gap_sec=0.35, chars_per_sec=14.0)
    assert len(w) == 2
    assert abs(w[0] - (10 + 0.35)) < 1e-9
    assert abs(w[1] - (20 + 0.35)) < 1e-9
    assert w[1] > w[0]
    # Degenerate chunk still gets a positive weight.
    assert estimate_weights([""])[0] > 0

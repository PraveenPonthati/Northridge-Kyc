import re
from backend.portal import format_ref, new_ref, parse_ref


class NoRows:
    def one(self, *args):
        return None


def test_new_reference_has_valid_check_digits():
    ref = new_ref(NoRows())
    assert re.fullmatch(r'NB-\d{4}-\d{6}-\d{2}', ref)
    assert parse_ref(ref) == (ref, True)


def test_reference_is_read_however_it_is_typed():
    ref = format_ref('2611004207')
    compact = ref.replace('-', '')
    assert parse_ref(compact.lower()) == (ref, True)
    assert parse_ref(f'  {ref.replace("-", " ")} ') == (ref, True)


def test_every_single_digit_typo_and_neighbour_swap_is_caught():
    ref = format_ref('2611483920')
    digits = [i for i, ch in enumerate(ref) if ch.isdigit()]
    for i in digits:
        for d in '0123456789':
            if d != ref[i]:
                assert parse_ref(ref[:i] + d + ref[i + 1:])[1] is False
    compact = ref.replace('-', '')
    for i in range(2, len(compact) - 1):
        if compact[i] != compact[i + 1]:
            swapped = compact[:i] + compact[i + 1] + compact[i] + compact[i + 2:]
            assert parse_ref(swapped)[1] is False


def test_legacy_and_non_references():
    assert parse_ref('nb-2026-999205') == ('NB-2026-999205', True)
    assert parse_ref('Ravi Menon') == (None, False)
    assert parse_ref('NB-2611') == (None, False)
